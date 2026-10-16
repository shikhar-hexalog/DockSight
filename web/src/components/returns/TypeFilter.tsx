import { RETURN_TYPES, RETURN_TYPE_LABEL } from '@hexabuild/shared';

import { TextToggle } from '@/components/common/TextToggle';
import { useTypeFilter } from '@/hooks/useTypeFilter';

const ALL = 'ALL';

const OPTIONS = [{ value: ALL, label: 'All' }, ...RETURN_TYPES.map(t => ({ value: t, label: RETURN_TYPE_LABEL[t] }))];

export function TypeFilter() {
  const { type, setType } = useTypeFilter();

  return (
    <div title="Type: RTO (courier couldn't deliver) or DTO (customer returned it)">
      <TextToggle label="Type" options={OPTIONS} value={type ?? ALL} onChange={value => setType(RETURN_TYPES.find(t => t === value))} />
    </div>
  );
}
