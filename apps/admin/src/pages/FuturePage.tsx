import { futureFeatures } from "../data/mockAdmin";
import { getSectionTitle } from "../data/navigation";
import type { AdminSection } from "../types/admin";
import { Badge } from "../components/ui/Badge";
import { EmptyState } from "../components/ui/EmptyState";

type FuturePageProps = {
  section: AdminSection;
};

export function FuturePage({ section }: FuturePageProps) {
  const features = futureFeatures[section] ?? ["Функции будут описаны после детализации раздела."];

  return (
    <div className="page-stack page-stack--center">
      <EmptyState description="Раздел будет добавлен позже" title={getSectionTitle(section)}>
        <div className="future-list" aria-label="Будущие функции">
          <Badge tone="blue">позже</Badge>
          <ul>
            {features.map((feature) => (
              <li key={feature}>{feature}</li>
            ))}
          </ul>
        </div>
      </EmptyState>
    </div>
  );
}
