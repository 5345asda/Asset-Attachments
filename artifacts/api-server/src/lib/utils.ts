import { randomBytes } from "node:crypto";

export const rid = () => "chatcmpl-" + randomBytes(4).toString("hex");
export const now = () => Math.floor(Date.now() / 1000);
