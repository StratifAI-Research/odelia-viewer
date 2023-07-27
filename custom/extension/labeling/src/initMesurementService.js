
import { ODELIALabel, ODELIA_LABELING_SOURCE_NAME, ODELIA_LABELING_SOURCE_VERSION } from './measuermentServiceMappings/ODELIALabel';
import { eventTarget } from '@cornerstonejs/core';
import { Enums, annotation } from '@cornerstonejs/tools';
import { DicomMetadataStore } from '@ohif/core';
import { toolNames } from './initCornerstoneTools';
import { onCompletedCalibrationLine } from './tools/CalibrationLineTool';


const { removeAnnotation } = annotation.state;

const csToolsEvents = Enums.Events;


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

const connectToolsToMeasurementService = servicesManager => {
  const {
    measurementService,
    displaySetService,
    cornerstoneViewportService,
  } = servicesManager.services;
  const ODELIAMeasurementSource = initMeasurementService(
    measurementService,
    displaySetService,
    cornerstoneViewportService
  );
  connectMeasurementServiceToTools(
    measurementService,
    cornerstoneViewportService,
    ODELIAMeasurementSource
  );
  const { annotationToMeasurement, remove } = ODELIAMeasurementSource;

  //
  function addMeasurement(csToolsEvent) {
    try {
      const annotationAddedEventDetail = csToolsEvent.detail;
      const {
        annotation: { metadata, annotationUID },
      } = annotationAddedEventDetail;
      const { toolName } = metadata;

      // To force the measurementUID be the same as the annotationUID
      // Todo: this should be changed when a measurement can include multiple annotations
      // in the future
      annotationAddedEventDetail.uid = annotationUID;
      annotationToMeasurement(toolName, annotationAddedEventDetail);

    } catch (error) {
      console.warn('Failed to update measurement:', error);
    }
  }

  function updateMeasurement(csToolsEvent) {
    try {
      const annotationModifiedEventDetail = csToolsEvent.detail;

      const {
        annotation: { metadata, annotationUID },
      } = annotationModifiedEventDetail;

      // If the measurement hasn't been added, don't modify it
      const measurement = measurementService.getMeasurement(annotationUID);

      if (!measurement) {
        return;
      }
      const { toolName } = metadata;

      annotationModifiedEventDetail.uid = annotationUID;
      // Passing true to indicate this is an update and NOT a annotation (start) completion.
      annotationToMeasurement(toolName, annotationModifiedEventDetail, true);
    } catch (error) {
      console.warn('Failed to update measurement:', error);
    }
  }
  function selectMeasurement(csToolsEvent) {
    try {
      const annotationSelectionEventDetail = csToolsEvent.detail;

      const {
        added: addedSelectedAnnotationUIDs,
        removed: removedSelectedAnnotationUIDs,
      } = annotationSelectionEventDetail;

      if (removedSelectedAnnotationUIDs) {
        removedSelectedAnnotationUIDs.forEach(annotationUID =>
          measurementService.setMeasurementSelected(annotationUID, false)
        );
      }

      if (addedSelectedAnnotationUIDs) {
        addedSelectedAnnotationUIDs.forEach(annotationUID =>
          measurementService.setMeasurementSelected(annotationUID, true)
        );
      }
    } catch (error) {
      console.warn('Failed to select and unselect measurements:', error);
    }
  }

  /**
   * When csTools fires a removed event, remove the same measurement
   * from the measurement service
   *
   * @param {*} csToolsEvent
   */
  function removeMeasurement(csToolsEvent) {
    try {
      try {
        const annotationRemovedEventDetail = csToolsEvent.detail;
        const {
          annotation: { annotationUID },
        } = annotationRemovedEventDetail;

        const measurement = measurementService.getMeasurement(annotationUID);

        if (measurement) {
          console.log('~~ removeEvt', csToolsEvent);
          remove(annotationUID, annotationRemovedEventDetail);
        }
      } catch (error) {
        console.warn('Failed to update measurement:', error);
      }
    } catch (error) {
      console.warn('Failed to remove measurement:', error);
    }
  }

  // on display sets added, check if there are any measurements in measurement service that need to be
  // put into cornerstone tools
  const addedEvt = csToolsEvents.ANNOTATION_ADDED;
  const completedEvt = csToolsEvents.ANNOTATION_COMPLETED;
  const updatedEvt = csToolsEvents.ANNOTATION_MODIFIED;
  const removedEvt = csToolsEvents.ANNOTATION_REMOVED;
  const selectionEvt = csToolsEvents.ANNOTATION_SELECTION_CHANGE;

  eventTarget.addEventListener(addedEvt, addMeasurement);
  eventTarget.addEventListener(completedEvt, addMeasurement);
  eventTarget.addEventListener(updatedEvt, updateMeasurement);
  eventTarget.addEventListener(removedEvt, removeMeasurement);
  eventTarget.addEventListener(selectionEvt, selectMeasurement);

  return ODELIAMeasurementSource;
};


export {
  initMeasurementService,
  connectToolsToMeasurementService,
};
