'use client'

import dynamic from 'next/dynamic';
import { PageLoader } from '@/components/PageLoader';

const ContactsPage = dynamic(
  () => import('@/features/contacts/ContactsPage').then((m) => ({ default: m.ContactsPage })),
  { loading: () => <PageLoader />, ssr: false }
);

export default function PlatformTenantContactsRoute() {
  return <ContactsPage />;
}
