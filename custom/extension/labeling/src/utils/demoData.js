const fs = require('fs')

// Sample study data
const studies = [
  {
    'Study ID': '001',
    AnnotationType: 'Measurement',
    'Patient ID': 'P123',
    'Patient Name': 'John Doe',
    StudyInstanceUID: '1.3.12.2.1107.5.4.3.123456789012345.19950922.121803.6',
    'Leison ID': 'L001',
  },
  {
    'Study ID': '002',
    AnnotationType: 'Segmentation',
    'Patient ID': 'P456',
    'Patient Name': 'Jane Doe',
    StudyInstanceUID: '1.3.12.2.1107.5.4.3.123456789012345.19951118.091520.7',
    'Leison ID': 'L002',
  },
  // Add more study data as needed
]

// Function to convert an array of objects to CSV
function convertToCSV(data, includeHeaders = true) {
  if (data.length === 0) {
    return ''
  }

  const headers = includeHeaders ? Object.keys(data[0]).join(',') : ''
  const rows = data.map(obj => Object.values(obj).map(value => `"${value}"`).join(','))
  return `${headers}\n${rows.join('\n')}`
}

// Generate CSV content without headers
const csvContent = convertToCSV(studies, true)

// Specify the file path and name
const filePath = 'study_list.csv'

// Write to the CSV file
fs.writeFile(filePath, csvContent, 'utf8', (err) => {
  if (err) {
    console.error('Error writing CSV file:', err)
  } else {
    console.log(`CSV file (${filePath}) has been successfully generated.`)
  }
})
