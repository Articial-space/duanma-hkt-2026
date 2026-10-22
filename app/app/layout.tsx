import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import {
  TideCloakProvider
} from '@tidecloak/nextjs'
import { TIDE_MODE, providerConfig } from './lib/tideConfig'


export const metadata: Metadata = {
  title: 'TruthVoice',
  description: 'Honest course feedback that no admin, lecturer or AI can read at will',
}

// tidecloak.json is the placeholder {} until the realm is initialised. Without a realm and
// auth-server-url (isTideConfigured, app/lib/mode.ts) the app runs in demo mode (no
// TideCloakProvider); with a real config it wraps as the template does, with DPoP switched on
// (S12: the Tide-mode API routes verify a DPoP proof).

interface RootLayoutProps {
  children: ReactNode
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body>
        {TIDE_MODE ? (
          <TideCloakProvider config={providerConfig()}>
            {children}
          </TideCloakProvider>
        ) : (
          children
        )}
      </body>
    </html>
  )
}
