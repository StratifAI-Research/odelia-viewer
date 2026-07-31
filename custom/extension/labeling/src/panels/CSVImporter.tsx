import React, { useRef } from 'react';
import { Button } from '@ohif/ui-next';
import Papa from 'papaparse';

type CSVRow = Record<string, string>;

type CSVImporterProps = {
  onClick?: (data: CSVRow[]) => void;
};

const CSVImporter = ({ onClick = () => {} }: CSVImporterProps) => {
  const ref = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) {
      return;
    }

    try {
      Papa.parse<CSVRow>(file, {
        worker: true,
        header: true,
        skipEmptyLines: true,
        complete: ({ data }) => onClick(data),
        // With worker:true parse errors are async, so the surrounding
        // try/catch never sees them — handle them here instead of silently
        // dropping the import.
        error: err => {
          console.error('CSV import failed to parse:', err);
        },
      });
    } catch (error) {
      console.error(error);
    } finally {
      // Reset the input so selecting the same file again re-fires
      // onChange (the browser suppresses change events for an unchanged value).
      input.value = '';
    }
  };

  return (
    <Button
      className="mx-2 px-2 py-2 text-base"
      onClick={() => ref.current?.click()}
    >
      Import CSV
      <input
        className="hidden"
        ref={ref}
        type="file"
        accept=".csv"
        onChange={handleFileChange}
      />
    </Button>
  );
};

export default CSVImporter;
