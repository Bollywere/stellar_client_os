"use client";

import { BackerDigestPreferenceToggle } from "@/components/modules/settings/BackerDigestPreferenceToggle";
import { useWallet } from "@/providers/StellarWalletProvider";

export default function NotificationSettingsPage() {
  const { address } = useWallet();

  return (
    <main className="h-full overflow-y-auto px-4 py-8 md:py-10">
      <div className="mx-auto max-w-2xl space-y-6">
        <header>
          <h1 className="text-2xl font-semibold">Notification Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Choose how you hear about the campaigns you have backed.
          </p>
        </header>
        <BackerDigestPreferenceToggle backerId={address ?? undefined} />
      </div>
    </main>
  );
}
