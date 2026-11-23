import nodemailer from "nodemailer";

export const SMTP_HOST = "smtp.exmail.qq.com";
export const SMTP_PORT = 465;
export const DEVELOPMENT_CC = "sales@sf6relations.com";

export function validMailAddress(value: string) {
  return /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(value) && value.length <= 254;
}

export function createSmtpTransport(email: string, password: string) {
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: true,
    auth: { user: email, pass: password },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    disableFileAccess: true,
    disableUrlAccess: true
  });
}
