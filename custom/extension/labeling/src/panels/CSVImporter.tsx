import React, { LegacyRef, useRef } from 'react';
import PropTypes from 'prop-types';
import { Button, ButtonGroup } from '@ohif/ui';
import Papa from 'papaparse';

type CSVRow = Record<string, string>;

type CSVImporterProps = {
  onClick: (data: CSVRow[]) => void;
};

const CSVImporter = ({ onClick }: CSVImporterProps) => {
  const ref: React.RefObject<HTMLInputElement> = useRef(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const input = e.target;
      try {
        const file = input.files![0];
        Papa.parse<CSVRow>(file, {
          worker: true,
          header: true,
          skipEmptyLines: true,
          complete: ({ data }) => onClick(data),
          // LAB-L5: with worker:true parse errors are async, so the surrounding
          // try/catch never sees them — handle them here instead of silently
          // dropping the import.
          error: err => {
            console.error('CSV import failed to parse:', err);
          },
        });
      } catch (error) {
        console.error(error);
      } finally {
        // LAB-L5: reset the input so selecting the same file again re-fires
        // onChange (the browser suppresses change events for an unchanged value).
        input.value = '';
      }
    }
  };

  return (
    <React.Fragment>
      <ButtonGroup color="black" size="inherit">
        <Button
          className="px-2 py-2 text-base mx-2"
          onClick={() => ref?.current?.click()}
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
      </ButtonGroup>
    </React.Fragment>
  );
};

CSVImporter.propTypes = {
  onClick: PropTypes.func,
};

CSVImporter.defaultProps = {
  onClick: () => {},
};

export default CSVImporter;
