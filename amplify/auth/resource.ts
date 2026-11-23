import { defineAuth } from "@aws-amplify/backend";
import { preSignUp } from "./pre-sign-up/resource";

/**
 * Authentication configuration for ICP Digital Archives.
 *
 * Security layers:
 * 1. Users authenticate with email.
 * 2. The pre-sign-up Lambda restricts registration to @icp.org.
 * 3. Cognito verifies ownership of the email account.
 * 4. Only approved Cognito groups receive archive permissions.
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
  },

  groups: [
    "ARCHIVE_USERS",
    "ARCHIVE_ADMINS",
  ],

  triggers: {
    preSignUp,
  },
});
