export const POSITION_ORDER = [
    'President',
    'Vice President',
    'General Secretary',
    'Financial Secretary',
    'Male Organizer',
    'Female Organizer',
    'Welfare Secretary',
    'Woman Commission',
];

export function comparePositionNames(a, b) {
    const ia = POSITION_ORDER.indexOf(a);
    const ib = POSITION_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
}

export function sortPositions(positions) {
    return [...positions].sort((a, b) => comparePositionNames(a.position_name, b.position_name));
}

export function candidatePhotoHtml(photoUrl, name, { imgClass, fallbackClass } = {}) {
    const hasPhoto = photoUrl && photoUrl.trim() !== '' && !photoUrl.includes('placeholder');
    if (hasPhoto) {
        return `<img src="${photoUrl}" alt="${name || 'Candidate'}" class="${imgClass}">`;
    }
    const initials = (name || '?').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    return `<span class="${fallbackClass}">${initials}</span>`;
}

export async function fetchCandidatePhotos(supabase, electionId) {
    const { data } = await supabase
        .from('candidates')
        .select('id, photo_url')
        .eq('election_id', electionId);

    return Object.fromEntries((data || []).map(c => [c.id, c.photo_url]));
}
