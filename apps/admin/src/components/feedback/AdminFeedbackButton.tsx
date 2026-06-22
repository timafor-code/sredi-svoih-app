import { Button } from "../ui/Button";

type AdminFeedbackButtonProps = {
  onClick: () => void;
};

export function AdminFeedbackButton({ onClick }: AdminFeedbackButtonProps) {
  return (
    <Button className="admin-feedback-button" onClick={onClick} variant="secondary">
      Оставить замечание
    </Button>
  );
}
