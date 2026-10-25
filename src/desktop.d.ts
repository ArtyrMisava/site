export {};

declare global {
  interface DusDesktopWorkbook {
    id: string;
    name: string;
    data: ArrayBuffer;
  }

  interface DusDesktopBridge {
    readonly isDesktop: true;
    readonly platform: string;
    pickExcelWorkbook(): Promise<DusDesktopWorkbook | null>;
    readExcelWorkbook(id: string): Promise<ArrayBuffer>;
    writeExcelWorkbook(id: string, data: ArrayBuffer): Promise<void>;
  }

  interface Window {
    dusDesktop?: DusDesktopBridge;
  }
}
