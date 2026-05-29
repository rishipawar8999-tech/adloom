import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { authenticate } from "../shopify.server";
import { getPlanWithAdmin } from "../models/billing.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const planInfo = await getPlanWithAdmin(admin); // live GraphQL call

  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    plan: planInfo.plan,
    hasActiveSubscription: planInfo.plan !== "Free",
  };
};

export default function App() {
  const { apiKey } = useLoaderData();

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home">
          Home
        </Link>
        <Link to="/app/timers">Timers</Link>
        <Link to="/app/coupons">Offers</Link>
        <Link to="/app/pricing">Pricing plans</Link>
        <Link to="/app/help">Help and Support</Link>
      </NavMenu>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs Remix to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
