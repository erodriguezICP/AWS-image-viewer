import { defineBackend } from "@aws-amplify/backend";
import { Effect, Policy, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Bucket } from "aws-cdk-lib/aws-s3";

import { auth } from "./auth/resource";
import { data } from "./data/resource";

const backend = defineBackend({
  auth,
  data,
});

/*
 * Existing external archive S3 bucket.
 */
const customBucketStack = backend.createStack("archive-bucket-stack");

const archiveBucket = Bucket.fromBucketAttributes(
  customBucketStack,
  "ArchiveBucket",
  {
    bucketArn: "arn:aws:s3:::manifest-inventory",
    region: "us-east-1",
  }
);

/*
 * Expose the existing archive bucket configuration to the Amplify frontend.
 *
 * The actual AWS authorization is controlled by the IAM policies
 * attached to the Cognito group roles below.
 */
backend.addOutput({
  storage: {
    aws_region: archiveBucket.env.region,
    bucket_name: archiveBucket.bucketName,
    buckets: [
      {
        aws_region: archiveBucket.env.region,
        bucket_name: archiveBucket.bucketName,
        name: archiveBucket.bucketName,
        paths: {
          "Key Manifest/*": {
            authenticated: ["get", "list"],
          },
          "Key Manifest Thumbnails/*": {
            authenticated: ["get", "list"],
          },
        },
      },
    ],
  },
});

/*
 * Archive S3 policy.
 *
 * Members of the authorized Cognito groups can:
 *
 * - List objects under Key Manifest/
 * - List objects under Key Manifest Thumbnails/
 * - Read/download objects under Key Manifest/
 * - Read thumbnail objects under Key Manifest Thumbnails/
 *
 * No PutObject, DeleteObject, or other write permission is granted.
 */
const archivePolicy = new Policy(
  backend.stack,
  "archiveBucketGroupAccessPolicy",
  {
    statements: [
      /*
       * Read original archive objects and generated thumbnails.
       */
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["s3:GetObject"],
        resources: [
          `${archiveBucket.bucketArn}/Key Manifest/*`,
          `${archiveBucket.bucketArn}/Key Manifest Thumbnails/*`,
        ],
      }),

      /*
       * Allow directory/object listing, but only for the archive
       * prefixes used by the viewer.
       */
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["s3:ListBucket"],
        resources: [archiveBucket.bucketArn],
        conditions: {
          StringLike: {
            "s3:prefix": [
              "Key Manifest/",
              "Key Manifest/*",
              "Key Manifest Thumbnails/",
              "Key Manifest Thumbnails/*",
            ],
          },
        },
      }),
    ],
  }
);

/*
 * Cognito group authorization.
 *
 * Unlike the previous implementation, the archive policy is NOT
 * attached to authenticatedUserIamRole.
 *
 * Therefore, simply having a verified Cognito account does not
 * automatically grant archive S3 permissions.
 */
const { groups } = backend.auth.resources;

/*
 * Standard approved archive users.
 */
groups["ARCHIVE_USERS"].role.attachInlinePolicy(
  archivePolicy
);

/*
 * Archive administrators.
 *
 * For now ADMIN users receive the same read/list archive permissions.
 * Additional administrative permissions can be added separately later
 * without changing ARCHIVE_USERS.
 */
groups["ARCHIVE_ADMINS"].role.attachInlinePolicy(
  archivePolicy
);
