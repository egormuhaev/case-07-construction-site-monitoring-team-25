import { ChartColumn } from '@gravity-ui/icons';
import { Flex, Icon, PlaceholderContainer, Text } from '@gravity-ui/uikit';

export default function AnalysisPage() {
  return (
    <Flex direction="column" gap={4}>
      <Text variant="header-1">Анализ нарушений</Text>
      <PlaceholderContainer
        title="Раздел в разработке"
        description="Здесь появится сводка нарушений по дням и камерам: отсутствие касок, опасные зоны и отклонения от плана."
        size="l"
        align="center"
        image={<Icon data={ChartColumn} size={56} />}
      />
    </Flex>
  );
}
