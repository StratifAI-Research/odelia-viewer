/** Minimal Part 10 export with explicit VR little endian metadata, for upload tests. */
export function dicomBytes(sopClass = '1.2.840.10008.5.1.4.1.1.2'): Uint8Array {
  const bytes: number[] = [...new Uint8Array(128), 68, 73, 67, 77];
  const uid = (group: number, element: number, value: string) => {
    const padded = value.length % 2 ? `${value}\0` : value;
    bytes.push(
      group,
      0,
      element,
      0,
      85,
      73,
      padded.length,
      0,
      ...Array.from(padded, char => char.charCodeAt(0))
    );
  };
  uid(2, 2, sopClass);
  uid(2, 3, '1.2.3.4');
  uid(2, 16, '1.2.840.10008.1.2.1');
  uid(8, 22, sopClass);
  return new Uint8Array(bytes);
}

export function dicomFile(name = 'scan.dcm', sopClass?: string): File {
  return new File([dicomBytes(sopClass)], name);
}
