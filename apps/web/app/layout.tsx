import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Ablests Digital Solution | Software built around you',
  description: 'Custom software development, InTouch CRM, and IterateView trading journal. Explore digital solutions built around your business.',
  icons: { icon: '/favicon.svg' },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
