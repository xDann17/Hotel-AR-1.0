import { Suspense } from "react";
import NewProjectExpensePage from "./new-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function Page() {
  return (
    <Suspense fallback={null}>
      <NewProjectExpensePage />
    </Suspense>
  );
}
