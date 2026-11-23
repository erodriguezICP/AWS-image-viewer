import { defineAuth } from "@aws-amplify/backend";
import { preSignUp } from "./pre-sign-up/resource";

/**
 * Authentication configuration for ICP Digital Archives.
 *
 * Users authenticate using email.
 * New registrations are validated by the pre-sign-up trigger.
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
  },

  triggers: {
    preSignUp,
  },
});
