/* eslint-disable */
/**
 * This file was automatically generated by json-schema-to-typescript.
 * DO NOT MODIFY IT BY HAND. Instead, modify the source JSONSchema file,
 * and run json-schema-to-typescript to regenerate this file.
 */

/**
 * Measures the number of warnings and errors in processing key transparency.
 */
export interface WebCryptoKeyTransparencyErrorsTotal {
  Value: number;
  Labels: {
    level: "warning" | "error";
    type: "public-key" | "self-audit" | "public-key-audit";
    visibility: "visible" | "hidden";
  };
}
