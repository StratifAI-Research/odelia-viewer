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
      try {
        const file = e.target.files[0];
        Papa.parse<CSVRow>(file, {
          worker: true,
          complete: ({ data }) => onClick(data),
          header: true,
          skipEmptyLines: true,
        });
        // 6. call the onChange event
      } catch (error) {
        console.error(error);
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
  onClick: () => alert('Export'),
};

export default CSVImporter;
