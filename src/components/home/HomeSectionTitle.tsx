import { SectionTitle } from '@/components/ui/SectionTitle';

type HomeSectionTitleProps = {
  action?: string;
  onActionPress?: () => void;
  title: string;
};

export function HomeSectionTitle({ action, onActionPress, title }: HomeSectionTitleProps) {
  return <SectionTitle title={title} action={action} onActionPress={onActionPress} />;
}
