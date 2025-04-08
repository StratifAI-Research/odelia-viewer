declare module '@ohif/extension-default' {
  export function requestDisplaySetCreationForStudy(
    dataSource: any,
    displaySetService: any,
    StudyInstanceUID: string,
    madeInClient: boolean
  ): Promise<void>;
}
