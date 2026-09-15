import React from 'react';

export default function WorkListWithNotification({ workListComponent: WorkList, ...props }) {
  const Notice = props.servicesManager.services.customizationService.getCustomization(
    'workList.updateNotification'
  );
  return (
    <>
      {Notice ? (
        <div data-cy="worklist-update-slot">
          <Notice />
        </div>
      ) : null}
      <WorkList {...props} />
    </>
  );
}
