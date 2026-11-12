import { defineBackend } from "@aws-amplify/backend";
import { Effect, Policy, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Bucket } from "aws-cdk-lib/aws-s3";

import { auth } from "./auth/resource";
import { data } from "./data/resource";

const backend = defineBackend({
  auth,
  data,
});

const customBucketStack = backend.createStack("archive-bucket-stack");

const archiveBucket = Bucket.fromBucketAttributes(
  customBucketStack,
  "ArchiveBucket",
  {
    bucketArn: "arn:aws:s3:::manifest-inventory",
    region: "us-east-1",
  }
);

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

const archivePolicy = new Policy(
  backend.stack,
  "archiveBucketAuthPolicy",
  {
    statements: [
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["s3:GetObject"],
        resources: [
          `${archiveBucket.bucketArn}/Key Manifest/*`,
          `${archiveBucket.bucketArn}/Key Manifest Thumbnails/*`,
        ],
      }),

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

backend.auth.resources.authenticatedUserIamRole.attachInlinePolicy(
  archivePolicy
);
