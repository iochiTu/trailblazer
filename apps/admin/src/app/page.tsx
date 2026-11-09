import { cookies } from "next/headers";
import { PortalPage } from "@/components/portal/PortalPage";

export default async function Home() {
  // Only decides which call to action to show; the dashboard still checks the session itself.
  const signedIn = (await cookies()).has("tb_session");
  return <PortalPage signedIn={signedIn} />;
}
