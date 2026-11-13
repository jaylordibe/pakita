// A database worker that fails while opening the database, as one does when
// the file was written by a newer Pakita.
throw new Error('The local database was written by a newer Pakita.');
