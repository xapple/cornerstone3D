import { postProcessDecodedPixels } from '../decodeImageFrameWorker';

// The codecs load WASM; scaling needs none of them.
jest.mock('../shared/decoders/decodeJPEGBaseline8Bit', () => jest.fn());
jest.mock('../shared/decoders/decodeJPEGLossless', () => jest.fn());
jest.mock('../shared/decoders/decodeJPEGLS', () => jest.fn());
jest.mock('../shared/decoders/decodeJPEG2000', () => jest.fn());
jest.mock('../shared/decoders/decodeHTJ2K', () => jest.fn());
jest.mock('../shared/decoders/decodeJPEGXL', () => jest.fn());

/** One row of 16-bit stored values, as a decoder hands them over. */
function frameOf(values: number[], pixelRepresentation = 1) {
  return {
    pixelData:
      pixelRepresentation === 1
        ? Int16Array.from(values)
        : Uint16Array.from(values),
    pixelRepresentation,
    bitsStored: 16,
    photometricInterpretation: 'MONOCHROME2',
    rows: 1,
    columns: values.length,
    samplesPerPixel: 1,
  };
}

function decode(
  values: number[],
  scalingParameters: Record<string, unknown>,
  targetType?: string
) {
  const options = {
    allowFloatRendering: true,
    preScale: { enabled: true, scalingParameters },
    ...(targetType ? { targetBuffer: { type: targetType } } : {}),
  };
  const frame = postProcessDecodedPixels(frameOf(values), options, 0, {});
  return frame.pixelData;
}

describe('postProcessDecodedPixels', () => {
  // A non-integer factor can give whole values at both ends of a slice and
  // fractions in between: the values must stay in a float array.
  describe('with a non-integer factor whose scaled extremes are whole', () => {
    it('keeps the halves of a PET in g/mL (suvbw 1, slope 0.5)', () => {
      const scaling = {
        rescaleSlope: 0.5,
        rescaleIntercept: 0,
        modality: 'PT',
        suvbw: 1,
      };

      for (const target of [undefined, 'Float32Array']) {
        const pixelData = decode([0, 3, 7, 10], scaling, target);

        expect(pixelData).toBeInstanceOf(Float32Array);
        expect(Array.from(pixelData)).toEqual([0, 1.5, 3.5, 5]);
      }
    });

    it('keeps the fractions of an FA map (slope 0.001, values 0 to 1000)', () => {
      const pixelData = decode([0, 13, 500, 999, 1000], {
        rescaleSlope: 0.001,
        rescaleIntercept: 0,
        modality: 'MR',
      });

      expect(pixelData).toBeInstanceOf(Float32Array);
      [0, 0.013, 0.5, 0.999, 1].forEach((value, i) => {
        expect(pixelData[i]).toBeCloseTo(value, 6);
      });
    });

    it('keeps the fractions of a dose grid whose extremes are whole', () => {
      const pixelData = decode([0, 1, 2500, 5000], {
        rescaleSlope: 1,
        rescaleIntercept: 0,
        modality: 'RTDOSE',
        doseGridScaling: 0.0002,
      });

      expect(pixelData).toBeInstanceOf(Float32Array);
      [0, 0.0002, 0.5, 1].forEach((value, i) => {
        expect(pixelData[i]).toBeCloseTo(value, 6);
      });
    });
  });

  // The lowest stored value gives the highest scaled one: an array chosen
  // from the two in that order was unsigned, and the negatives wrapped.
  it('keeps the negatives of a negative slope', () => {
    const pixelData = decode([0, 3, 10], {
      rescaleSlope: -1,
      rescaleIntercept: 0,
      modality: 'CT',
    });

    expect(pixelData).toBeInstanceOf(Int8Array);
    expect(Array.from(pixelData)).toEqual([0, -3, -10]);
  });

  it('still keeps integer scaling in the smallest integer array', () => {
    const pixelData = decode([0, 24, 1024, 4095], {
      rescaleSlope: 1,
      rescaleIntercept: -1024,
      modality: 'CT',
    });

    expect(pixelData).toBeInstanceOf(Int16Array);
    expect(Array.from(pixelData)).toEqual([-1024, -1000, 0, 3071]);
  });
});
