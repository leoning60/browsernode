export function capTextLength(text: string, maxLength: number): string {
	if (text.length > maxLength) {
		return text.slice(0, maxLength) + "...";
	}
	return text;
}
