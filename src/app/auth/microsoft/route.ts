import { NextResponse } from "next/server";

export async function GET() {
  const clientId = process.env.MICROSOFT_CLIENT_ID!;
  const redirectUri = `${process.env.NEXT_PUBLIC_SITE_URL}auth/microsoft/callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: "Tasks.ReadWrite offline_access",
    response_mode: "query",
  });

  return NextResponse.redirect(
    `https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?${params}`
  );
}
