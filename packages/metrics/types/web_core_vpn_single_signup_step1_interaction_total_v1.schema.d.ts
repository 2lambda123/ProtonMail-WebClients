/* eslint-disable */
/**
 * This file was automatically generated by json-schema-to-typescript.
 * DO NOT MODIFY IT BY HAND. Instead, modify the source JSONSchema file,
 * and run json-schema-to-typescript to regenerate this file.
 */

/**
 * Measures the number of first interactions with steps in Step 1 of the vpn single signup page.
 */
export interface WebCoreVpnSingleSignupStep1InteractionTotal {
  Value: number;
  Labels: {
    step: "plan" | "email" | "payment";
  };
}
