import { requireOptionalNativeModule } from 'expo-modules-core';

export type NativeWatermarkPosition =
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'center';

type NativeVideoWatermarkModule = {
  addWatermark(
    videoUri: string,
    watermarkUri: string,
    position: NativeWatermarkPosition,
    opacity: number,
    scale: number
  ): Promise<string>;
};

export default requireOptionalNativeModule<NativeVideoWatermarkModule>('NativeVideoWatermark');
