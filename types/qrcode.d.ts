declare module 'qrcode' {
  type ErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H';

  interface QRModules {
    size: number;
    get(row: number, column: number): boolean;
  }

  interface QRCodeResult {
    modules: QRModules;
  }

  const QRCodeGenerator: {
    create(value: string, options?: { errorCorrectionLevel?: ErrorCorrectionLevel }): QRCodeResult;
  };

  export default QRCodeGenerator;
}
