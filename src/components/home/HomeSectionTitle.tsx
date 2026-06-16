import { SectionTitle } from '@/components/ui/SectionTitle';

type HomeSectionTitleProps = {
  action?: string;
  title: string;
};

export function HomeSectionTitle({ action, title }: HomeSectionTitleProps) {
  return <SectionTitle title={title} action={action} />;
}
