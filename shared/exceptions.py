"""
Custom exceptions for ML Integration services
"""


class DicomRetrievalError(Exception):
    """Raised when DICOM data cannot be retrieved"""
    pass


class OrthancCommunicationError(Exception):
    """Raised when communication with Orthanc fails"""
    pass


class SeriesNotFoundError(Exception):
    """Raised when a requested series cannot be found"""
    pass
