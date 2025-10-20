export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function InvoiceIdSegmentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Minimal pass-through layout so /invoices/[id] is a registered segment
  return <>{children}</>;
}
