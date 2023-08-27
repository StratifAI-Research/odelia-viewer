import React, { useRef } from "react";
import PropTypes from 'prop-types';

import Papa from "papaparse";
type Props = {
  onChange(data: string[][]): void;
};
import { Button, ButtonGroup } from '@ohif/ui';

const CSVImporter = ({ onClick }: Props) => {
  const ref = useRef()
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      try {
        const file = e.target.files[0];

        Papa.parse<string[]>(file, {
          worker: true, // use a web worker so that the page doesn't hang up
          complete({ data }) {
            onClick(data);
          },
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
        <Button className="px-2 py-2 text-base" onClick={() => ref.current.click()}>
          Import CSV
          <input style={{ display: 'none' }} ref={ref} type="file" accept=".csv" onChange={handleFileChange} />
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
