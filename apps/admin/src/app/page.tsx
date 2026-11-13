import { organizationLd } from "@traiblazer/marketing";
import { cookies } from "next/headers";
import { PortalPage } from "@/components/portal/PortalPage";
import { JsonLd } from "@/components/site/JsonLd";
import { siteConfig } from "@/lib/site";

export default async function Home() {
  // Only decides which call to action to show; the dashboard still checks the session itself.
  const signedIn = (await cookies()).has("tb_session");
  return (
    <>
      <JsonLd data={{ "@context": "https://schema.org", ...organizationLd(siteConfig(), "en") }} />
      <PortalPage signedIn={signedIn} />
    </>
  );
}
