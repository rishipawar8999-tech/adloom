import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
  BillingInterval,
  BillingReplacementBehavior,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.January25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  billing: {
    "Basic": {
      replacementBehavior: BillingReplacementBehavior.ApplyImmediately,
      trialDays: 7,
      lineItems: [
        {
          amount: 9.99,
          currencyCode: "USD",
          interval: BillingInterval.Every30Days,
        }
      ],
    },
    "Basic Annual": {
      replacementBehavior: BillingReplacementBehavior.ApplyImmediately,
      trialDays: 7,
      lineItems: [
        {
          amount: 99.0,
          currencyCode: "USD",
          interval: BillingInterval.Annual,
        }
      ],
    },
    "Growth": {
      replacementBehavior: BillingReplacementBehavior.ApplyImmediately,
      trialDays: 7,
      lineItems: [
        {
          amount: 19.99,
          currencyCode: "USD",
          interval: BillingInterval.Every30Days,
        }
      ],
    },
    "Growth Annual": {
      replacementBehavior: BillingReplacementBehavior.ApplyImmediately,
      trialDays: 7,
      lineItems: [
        {
          amount: 199.0,
          currencyCode: "USD",
          interval: BillingInterval.Annual,
        }
      ],
    },
    "Pro": {
      replacementBehavior: BillingReplacementBehavior.ApplyImmediately,
      trialDays: 7,
      lineItems: [
        {
          amount: 29.99,
          currencyCode: "USD",
          interval: BillingInterval.Every30Days,
        }
      ],
    },
    "Pro Annual": {
      replacementBehavior: BillingReplacementBehavior.ApplyImmediately,
      trialDays: 7,
      lineItems: [
        {
          amount: 299.0,
          currencyCode: "USD",
          interval: BillingInterval.Annual,
        }
      ],
    },
  },
  future: {
    unstable_newEmbeddedAuthStrategy: true,
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.January25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
