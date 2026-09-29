import { Button, Flex, Text } from '@gravity-ui/uikit';
import { FINDING_BUTTON_COPY } from '../analysisCopy';
import type { AnalysisFinding } from '../api';

type Props = {
  status: AnalysisFinding['status'];
  disabled?: boolean;
  loadingConfirm?: boolean;
  loadingDismiss?: boolean;
  showOpen?: boolean;
  onOpen?: () => void;
  onConfirm: () => void;
  onDismiss: () => void;
  compact?: boolean;
};

export function FindingActions({
  status,
  disabled,
  loadingConfirm,
  loadingDismiss,
  showOpen,
  onOpen,
  onConfirm,
  onDismiss,
  compact,
}: Props) {
  return (
    <Flex direction="column" gap={2} className={compact ? undefined : 'max-w-xl'}>
      {!compact && (
        <Text color="secondary" variant="caption-2">
          {FINDING_BUTTON_COPY.hint}
        </Text>
      )}
      <Flex gap={2} wrap>
        {showOpen && onOpen && (
          <Button size="s" view="flat-secondary" title={FINDING_BUTTON_COPY.open.title} onClick={onOpen}>
            {FINDING_BUTTON_COPY.open.text}
          </Button>
        )}
        <Button
          size="s"
          view="outlined-success"
          title={FINDING_BUTTON_COPY.confirm.title}
          disabled={status === 'CONFIRMED' || disabled}
          loading={loadingConfirm}
          onClick={onConfirm}
        >
          {FINDING_BUTTON_COPY.confirm.text}
        </Button>
        <Button
          size="s"
          view="outlined"
          title={FINDING_BUTTON_COPY.dismiss.title}
          disabled={status === 'DISMISSED' || disabled}
          loading={loadingDismiss}
          onClick={onDismiss}
        >
          {FINDING_BUTTON_COPY.dismiss.text}
        </Button>
      </Flex>
      {!compact && (
        <Flex direction="column" gap={1}>
          <Text color="secondary" variant="caption-2">
            <b>Подтвердить</b> — {FINDING_BUTTON_COPY.confirm.hint}
          </Text>
          <Text color="secondary" variant="caption-2">
            <b>Отклонить</b> — {FINDING_BUTTON_COPY.dismiss.hint}
          </Text>
        </Flex>
      )}
    </Flex>
  );
}
