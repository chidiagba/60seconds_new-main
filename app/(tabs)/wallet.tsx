import React from "react";
import { Redirect } from "expo-router";

export default function WalletTabRedirect() {
  return <Redirect href="/payment-methods" />;
}
