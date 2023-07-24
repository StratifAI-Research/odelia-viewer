
import { ODELIALabel, ODELIA_LABELING_SOURCE_NAME, ODELIA_LABELING_SOURCE_VERSION } from './measuermentServiceMappings/ODELIALabel';


const initMeasurementService = (
  measurementService,
) => {
  /* Initialization */
  const ODELIALabelMapping =
  {
    toAnnotation: ODELIALabel.toAnnotation,
    toMeasurement: formEvent =>
      ODELIALabel.toMeasurement(
        formEvent
      ),
    matchingCriteria: [
      {
        valueType: "ODELIALabel",
        points: 0,
      },
    ],
  }

  const ODELIAMeasurementSource = measurementService.createSource(
    ODELIA_LABELING_SOURCE_NAME,
    ODELIA_LABELING_SOURCE_VERSION
  );

  /* Mappings */
  measurementService.addMapping(
    ODELIAMeasurementSource,
    'ODELIALabel',
    ODELIALabelMapping.matchingCriteria,
    ODELIALabelMapping.toAnnotation,
    ODELIALabelMapping.toMeasurement
  );

  measurementService.addMeasurementSchemaKeys(["label_data"])

  return ODELIAMeasurementSource;
};

export {
  initMeasurementService,
};
