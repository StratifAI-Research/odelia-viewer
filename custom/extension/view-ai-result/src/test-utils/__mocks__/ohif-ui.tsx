import React from 'react';
export const useImageViewer = () => ({ StudyInstanceUIDs: [] as string[] });
export const useUserAuthentication = () => [{ user: null }, { getAuthorizationHeader: () => ({}) }];
export const ButtonEnums = {
  type: { primary: 'primary', secondary: 'secondary' },
  size: { small: 'small', medium: 'medium' },
};
export const Dialog = ({ children }: any) => <div data-testid="dialog">{children}</div>;
