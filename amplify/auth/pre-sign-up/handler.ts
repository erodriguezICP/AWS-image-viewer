import type { PreSignUpTriggerHandler } from "aws-lambda";
import { env } from "$amplify/env/pre-sign-up";

export const handler: PreSignUpTriggerHandler = async (event) => {
  const email = event.request.userAttributes["email"]
    ?.trim()
    .toLowerCase();

  if (!email) {
    throw new Error("An email address is required.");
  }

  const parts = email.split("@");

  if (
    parts.length !== 2 ||
    !parts[0] ||
    parts[1] !== env.ALLOW_DOMAIN.toLowerCase()
  ) {
    throw new Error(
      "Registration is restricted to authorized ICP email accounts."
    );
  }

  return event;
};
