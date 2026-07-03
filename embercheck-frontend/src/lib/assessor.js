// Assessor registration API (Phase 2, Step 3). Authenticated calls go through
// apiFetch so the Bearer access token is attached and a 401 triggers a single
// silent refresh + retry — same pattern as lib/cases.js.

import { apiFetch } from './auth'

// GET /assessor/me. Returns the profile on 200, or null on 404 ("no application
// yet" — the screen shows the form). Any other failure throws a friendly Error.
export async function getMyAssessorProfile() {
  let response
  try {
    response = await apiFetch('/assessor/me')
  } catch {
    throw new Error('We couldn’t reach the server. Please try again.')
  }
  if (response.status === 404) return null
  if (!response.ok) {
    if (response.status === 401) throw new Error('Please log in to continue.')
    throw new Error('We couldn’t load your application just now. Please try again.')
  }
  return response.json()
}

// GET /assessor/{assessorId}/public — another assessor's PUBLIC profile (the
// safe allow-list the backend exposes to any logged-in consumer choosing who
// certifies their case). Never carries private data (phone/abn/insurer/etc.);
// insurance is a presence flag only. A 404 means "no such approved assessor"
// (unknown id, or a non-APPROVED profile the backend hides).
export async function getPublicAssessorProfile(assessorId) {
  let response
  try {
    response = await apiFetch(`/assessor/${assessorId}/public`)
  } catch {
    throw new Error('We couldn’t reach the server. Please try again.')
  }
  if (!response.ok) {
    if (response.status === 401) throw new Error('Please log in to continue.')
    if (response.status === 404) throw new Error('This assessor’s profile isn’t available.')
    throw new Error('We couldn’t load this profile just now. Please try again.')
  }
  return response.json()
}

// GET /assessor/{id}/photo — an APPROVED assessor's public profile photo as an
// object URL. A plain <img src> can't carry the Bearer token, so we fetch via
// apiFetch and wrap the blob. Returns null if the assessor has no photo (or the
// call fails). Caller revokes the URL when swapping/unmounting.
export async function getAssessorPublicPhotoUrl(assessorId) {
  let response
  try {
    response = await apiFetch(`/assessor/${assessorId}/photo`)
  } catch {
    return null
  }
  if (!response.ok) return null
  const blob = await response.blob()
  return URL.createObjectURL(blob)
}

// GET /assessor/{id}/banner — an APPROVED assessor's public banner image as an
// object URL (only when they chose an image banner). Returns null otherwise.
export async function getAssessorPublicBannerUrl(assessorId) {
  let response
  try {
    response = await apiFetch(`/assessor/${assessorId}/banner`)
  } catch {
    return null
  }
  if (!response.ok) return null
  const blob = await response.blob()
  return URL.createObjectURL(blob)
}

// POST /assessor/register with a JSON body (mirrors createCase). Returns the
// created profile. A 409 means an application already exists.
export async function registerAssessor(payload) {
  let response
  try {
    response = await apiFetch('/assessor/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  } catch {
    throw new Error('We couldn’t reach the server. Please try again.')
  }
  if (!response.ok) {
    if (response.status === 401) throw new Error('Please log in to continue.')
    if (response.status === 409) {
      throw new Error('You already have an assessor application.')
    }
    if (response.status === 422) {
      const detail = await response.json().then((j) => j.detail).catch(() => null)
      throw new Error(typeof detail === 'string' ? detail : 'Please check your details and try again.')
    }
    throw new Error('We couldn’t submit your application just now. Please try again.')
  }
  return response.json()
}

// POST /assessor/documents (multipart). files and docTypes are parallel arrays
// (docTypes[i] tags files[i]). Posts with Content-Type undefined so the browser
// sets the multipart boundary — exactly like uploadSectorPhotos. Returns the
// updated profile.
export async function uploadAssessorDocuments(files, docTypes) {
  const formData = new FormData()
  for (const file of files) formData.append('files', file)
  for (const docType of docTypes) formData.append('doc_types', docType)

  let response
  try {
    response = await apiFetch('/assessor/documents', {
      method: 'POST',
      body: formData,
      headers: { 'Content-Type': undefined },
    })
  } catch {
    throw new Error('We couldn’t upload your documents. Please try again.')
  }
  if (!response.ok) {
    if (response.status === 401) throw new Error('Please log in to continue.')
    if (response.status === 404) throw new Error('Register before uploading documents.')
    if (response.status === 413) throw new Error('Each file must be under 10 MB.')
    if (response.status === 422) {
      const detail = await response.json().then((j) => j.detail).catch(() => null)
      throw new Error(typeof detail === 'string' ? detail : 'Only PDF, JPEG and PNG files are accepted.')
    }
    throw new Error('We couldn’t upload your documents. Please try again.')
  }
  return response.json()
}
