export interface MetroStation {
  name: string
  corridor: string
  zones: string[]
}

// Demonstration data for Ahmedabad Metro Phase II operations.
export const metroStations: MetroStation[] = [
  { name: 'Motera Stadium', corridor: 'Motera–Mahatma Mandir', zones: ['Concourse', 'Platform 1', 'Platform 2', 'Entry Gate'] },
  { name: 'Koteshwar Road', corridor: 'Motera–Mahatma Mandir', zones: ['Concourse', 'Platform 1', 'Platform 2', 'Exit Gate'] },
  { name: 'Gandhinagar Sector 1', corridor: 'Motera–Mahatma Mandir', zones: ['Concourse', 'Platform 1', 'Platform 2', 'Entry Gate'] },
  { name: 'Mahatma Mandir', corridor: 'Motera–Mahatma Mandir', zones: ['Concourse', 'Platform 1', 'Platform 2', 'Bus Bay'] },
  { name: 'GNLU', corridor: 'GNLU–GIFT City', zones: ['Concourse', 'Interchange', 'Platform 1', 'Entry Gate'] },
  { name: 'GIFT City', corridor: 'GNLU–GIFT City', zones: ['Concourse', 'Platform 1', 'Platform 2', 'Entry Gate'] },
]
