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
  // Webhooks are now configured in shopify.app.toml and handled by app/routes/webhooks.jsx
  // We will need to verify if APP_SUBSCRIPTION_UPDATE needs explicit registration or config in TOML.
  billing: {
    "Basic": {
      replacementBehavior: BillingReplacementBehavior.ApplyImmediately,
      trialDays: 3,
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
      trialDays: 3,
      lineItems: [
        {
          amount: 95.90,
          currencyCode: "USD",
          interval: BillingInterval.Annual,
        }
      ],
    },
    "Growth": {
      replacementBehavior: BillingReplacementBehavior.ApplyImmediately,
      trialDays: 3,
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
      trialDays: 3,
      lineItems: [
        {
          amount: 191.90,
          currencyCode: "USD",
          interval: BillingInterval.Annual,
        }
      ],
    },
    "Pro": {
      replacementBehavior: BillingReplacementBehavior.ApplyImmediately,
      trialDays: 3,
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
      trialDays: 3,
      lineItems: [
        {
          amount: 287.90,
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

// Internal Cron Scheduler
import { runCronTasks } from "./cron.server";

if (process.env.NODE_ENV === "production" || process.env.NODE_ENV === "development") {
  if (!global.__cronInterval) {
    console.log("[Internal Scheduler] Initializing background task runner...");
    global.__cronInterval = setInterval(async () => {
       try {
         const results = await runCronTasks();
         if (results.started.length > 0 || results.ended.length > 0 || results.downgrades > 0) {
           console.log(`[Internal Scheduler] Run complete: Started ${results.started.length}, Ended ${results.ended.length}, Downgrades ${results.downgrades}`);
         }
       } catch (e) {
         console.error("[Internal Scheduler] Error running tasks:", e);
       }
    }, 60000); // Run every 60 seconds
  }
}
