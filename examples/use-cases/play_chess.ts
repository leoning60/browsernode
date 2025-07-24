/**
 * Goal: Play chess against the computer on Lichess and win
 *
 * This example demonstrates how to use browsernode to automate chess gameplay
 * with custom actions for reading board state and playing moves.
 * @dev You need to add OPENAI_API_KEY to your environment variables.
 */

import {
	ActionResult,
	Agent,
	BrowserProfile,
	BrowserSession,
	Controller,
} from "browsernode";
import { ChatOpenAI } from "browsernode/llm";
import * as cheerio from "cheerio";
import { Chess } from "chess.js";
import { z } from "zod";

// Check required environment variables
if (!process.env.OPENAI_API_KEY) {
	throw new Error(
		"OPENAI_API_KEY is not set. Please add it to your environment variables.",
	);
}

// Zod schema for play move action
const PlayMoveSchema = z.object({
	move: z
		.string()
		.describe(
			"The move in Standard Algebraic Notation (SAN) exactly as provided in the 'Legal Moves' list (e.g., 'Nf3', 'e4', 'Qh7#').",
		),
});

type PlayMoveParams = z.infer<typeof PlayMoveSchema>;

// Constants
const FILES = "abcdefgh";
const RANKS = "87654321";

// --- Helper Functions ---

function toPx(val: number): string {
	/**Convert float to px string, e.g. 42.0 -> '42px'.*/
	const s = val.toFixed(1).replace(/\.?0+$/, "");
	return `${s}px`;
}

function fromPx(px: string): number {
	/**Convert px string to float, e.g. '42px' -> 42.0.*/
	return parseFloat(px.replace("px", "").trim());
}

function parseTransform(style: string): [number, number] | null {
	/**Extracts x and y pixel coordinates from a CSS transform string.*/
	try {
		const parts = style.split("(");
		if (parts.length < 2) return null;

		const coords = parts[1]?.split(")");
		if (!coords || coords.length < 1) return null;

		const values = coords[0]?.split(",");
		if (!values || values.length < 2) return null;

		const xPx = parseFloat(values[0]?.trim().replace("px", "") ?? "0");
		const yPx = parseFloat(values[1]?.trim().replace("px", "") ?? "0");
		return [xPx, yPx];
	} catch (e) {
		console.error(`Error parsing transform style: ${e}`);
		return null;
	}
}

function algebraicToPixels(
	square: string,
	squareSize: number,
): [string, string] {
	/**Converts algebraic notation to Lichess pixel coordinates using dynamic size.*/
	if (square.length < 2) {
		throw new Error(`Invalid square: ${square}`);
	}

	const fileChar = square[0]?.toLowerCase();
	const rankChar = square[1];

	if (
		!fileChar ||
		!rankChar ||
		!FILES.includes(fileChar) ||
		!RANKS.includes(rankChar)
	) {
		throw new Error(`Invalid square: ${square}`);
	}

	const xIndex = FILES.indexOf(fileChar);
	const yIndex = RANKS.indexOf(rankChar);

	const xPx = xIndex * squareSize;
	const yPx = yIndex * squareSize;
	return [toPx(xPx), toPx(yPx)];
}

function pixelsToAlgebraic(
	xPx: number,
	yPx: number,
	squareSize: number,
): string {
	/**Converts Lichess pixel coordinates to algebraic notation using dynamic size.*/
	if (!squareSize) {
		throw new Error("Square size cannot be zero or None.");
	}

	const xIndex = Math.round(xPx / squareSize);
	const yIndex = Math.round(yPx / squareSize);

	if (xIndex >= 0 && xIndex < 8 && yIndex >= 0 && yIndex < 8) {
		return `${FILES[xIndex]}${RANKS[yIndex]}`;
	}

	throw new Error(`Pixel coordinates out of bounds: (${xPx}, ${yPx})`);
}

async function calculateSquareSize(
	browserSession: BrowserSession,
): Promise<number | null> {
	/**Dynamically calculates the size of a chess square in pixels.*/
	try {
		const page = await browserSession.getCurrentPage();
		const boardHTML = await page
			.locator("cg-board")
			.innerHTML({ timeout: 3000 });
		const $ = cheerio.load(boardHTML);
		const pieces = $("piece");

		if (pieces.length === 0) {
			throw new Error("No pieces found.");
		}

		const xCoords: Set<number> = new Set();
		pieces.each((_, element) => {
			const style = $(element).attr("style");
			if (style) {
				const coords = parseTransform(style);
				if (coords) {
					xCoords.add(coords[0]);
				}
			}
		});

		const sortedX = Array.from(xCoords).sort((a, b) => a - b);
		const xDiffs = sortedX.slice(1).map((x, i) => {
			const prevX = sortedX[i];
			return prevX !== undefined ? x - prevX : 0;
		});
		const validDiffs = xDiffs.filter((d) => d > 1);
		if (validDiffs.length === 0) return null;

		const squareSize = Math.round(Math.min(...validDiffs) * 10) / 10;
		console.log(`Calculated square size: ${squareSize}px`);
		return squareSize;
	} catch (e) {
		console.error(`Error calculating square size: ${e}`);
		return null;
	}
}

function getPieceSymbol(classList: string[]): string {
	const color = classList[0];
	const ptype = classList[1];
	const symbols: { [key: string]: string } = {
		king: "k",
		queen: "q",
		rook: "r",
		bishop: "b",
		knight: "n",
		pawn: "p",
	};
	const symbol = ptype ? symbols[ptype] || "?" : "?";
	return color === "white" ? symbol.toUpperCase() : symbol;
}

function createFenBoard(boardState: { [key: string]: string }): string {
	let fen = "";
	for (const rankNum of RANKS) {
		let emptyCount = 0;
		for (const fileChar of FILES) {
			const square = `${fileChar}${rankNum}`;
			if (square in boardState) {
				if (emptyCount > 0) {
					fen += emptyCount.toString();
					emptyCount = 0;
				}
				fen += boardState[square];
			} else {
				emptyCount++;
			}
		}
		if (emptyCount > 0) {
			fen += emptyCount.toString();
		}
		if (rankNum !== RANKS[RANKS.length - 1]) {
			fen += "/";
		}
	}
	return fen;
}

async function getCurrentBoardInfo(
	browserSession: BrowserSession,
): Promise<[string | null, number | null]> {
	/**Reads the current board HTML and returns FEN string and square size.*/
	const boardState: { [key: string]: string } = {};
	let boardHTML = "";
	let squareSize: number | null = null;

	try {
		const page = await browserSession.getCurrentPage();
		const boardLocator = page.locator("cg-board");
		await boardLocator.waitFor({ state: "visible", timeout: 3000 });
		boardHTML = await boardLocator.innerHTML();
		squareSize = await calculateSquareSize(browserSession);
	} catch (e) {
		console.error(`Error (get_info): Could not read cg-board: ${e}`);
		return [null, null];
	}

	if (!boardHTML || !squareSize) {
		return [null, null];
	}

	const $ = cheerio.load(boardHTML);
	const pieces = $("piece");

	pieces.each((_, element) => {
		const style = $(element).attr("style");
		const classAttr = $(element).attr("class");

		if (style && classAttr) {
			const coords = parseTransform(style);
			if (coords) {
				const [xPx, yPx] = coords;
				try {
					const square = pixelsToAlgebraic(xPx, yPx, squareSize);
					const classList = classAttr.split(" ");
					boardState[square] = getPieceSymbol(classList);
				} catch (ve) {
					console.error(`Error: ${ve}`);
				}
			}
		}
	});

	if (Object.keys(boardState).length === 0 || !squareSize) {
		return [null, null];
	}

	const fenBoard = createFenBoard(boardState);
	const fullFen = `${fenBoard} w KQkq - 0 1`;
	return [fullFen, squareSize];
}

// Initialize controller for custom actions
const controller = new Controller();

// Register custom actions with correct browsernode syntax and parameter handling
controller.action(
	"Analyzes the current Lichess chess board and returns FEN position plus legal moves in SAN notation",
)(async function analyzeChessBoard(browser: BrowserSession) {
	/**Reads the board, returns FEN and legal moves in SAN (+/#), and the last move by opponent if possible.*/
	console.log("🔍 Analyzing chess board...");
	const [fullFen, _] = await getCurrentBoardInfo(browser);

	if (!fullFen) {
		return new ActionResult({
			extractedContent: "Could not read chess board state.",
		});
	}

	const legalMovesDescriptive: string[] = [];
	let lastMoveSan: string | null = null;

	try {
		const page = await browser.getCurrentPage();
		const moveListHTML = await page.locator("l4x").innerHTML({ timeout: 3000 });
		const $ = cheerio.load(moveListHTML);
		const moveTags = $("kwdb");
		const moves = moveTags
			.map((_, el) => $(el).text().trim())
			.get()
			.filter(Boolean);
		lastMoveSan = moves.length > 0 ? moves[moves.length - 1] || null : null;
	} catch (e) {
		console.error(`Error extracting move list: ${e}`);
		lastMoveSan = null;
	}

	try {
		const board = new Chess(fullFen);
		const legalMoves = board.moves();

		for (const move of legalMoves) {
			const moveObj = board.move(move);
			if (!moveObj) continue;

			const san = moveObj.san;
			const isCheckmate = board.isCheckmate();
			const isCheck = board.isCheck();
			board.undo();

			let moveStrOut = san.replace("+", "");
			if (isCheckmate) {
				moveStrOut += "#";
			} else if (isCheck) {
				moveStrOut += "+";
			}
			legalMovesDescriptive.push(moveStrOut);
		}
	} catch (chessErr) {
		console.error(`Error generating SAN moves: ${chessErr}. FEN: ${fullFen}`);
		legalMovesDescriptive.push("Error");
	}

	let resultText = `CHESS BOARD ANALYSIS:
FEN: ${fullFen}
Legal Moves (SAN): ${legalMovesDescriptive.join(", ")}`;
	if (lastMoveSan) {
		resultText = `Last move: ${lastMoveSan}
${resultText}`;
	}
	console.log(`Chess board analysis result: ${resultText}`);

	return new ActionResult({
		extractedContent: resultText,
		includeInMemory: true,
	});
});

controller.action(
	"Executes a chess move on Lichess by clicking coordinates - only use moves from analyzeChessBoard",
	{
		paramModel: PlayMoveSchema,
	},
)(async function executeChessMove(
	params: PlayMoveParams,
	browser: BrowserSession,
) {
	/**Plays a chess move given in SAN by converting it to UCI and clicking coordinates on Lichess.*/
	const sanMove = params.move.trim();
	console.log(`🎯 Executing chess move: ${sanMove}`);
	let uciMove = "";

	try {
		const [currentFen, squareSize] = await getCurrentBoardInfo(browser);
		if (!currentFen || squareSize === null) {
			return new ActionResult({
				extractedContent:
					"Failed to get current FEN or square size to execute move.",
			});
		}

		const board = new Chess(currentFen);
		const sanToParse = sanMove.replace("#", "").replace("+", "");
		const moveObj = board.move(sanToParse);
		if (!moveObj) {
			return new ActionResult({
				extractedContent: `Could not parse SAN move '${sanMove}' - make sure it's from the legal moves list`,
			});
		}
		uciMove = moveObj.from + moveObj.to + (moveObj.promotion || "");
		board.undo(); // Undo the move since we just wanted the UCI
	} catch (e) {
		return new ActionResult({
			extractedContent: `Could not parse SAN move '${sanMove}' or get FEN: ${e}`,
		});
	}

	const startSq = uciMove.slice(0, 2);
	const endSq = uciMove.slice(2, 4);

	try {
		const [currentFen, squareSize] = await getCurrentBoardInfo(browser);
		if (!squareSize) {
			return new ActionResult({
				extractedContent: "Could not get square size for move execution",
			});
		}

		const [startXStr, startYStr] = algebraicToPixels(startSq, squareSize);
		const [endXStr, endYStr] = algebraicToPixels(endSq, squareSize);
		const startX = fromPx(startXStr);
		const startY = fromPx(startYStr);
		const endX = fromPx(endXStr);
		const endY = fromPx(endYStr);

		const page = await browser.getCurrentPage();
		const boardLocator = page.locator("cg-board");
		await boardLocator.waitFor({ state: "visible", timeout: 3000 });

		const clickOffset = squareSize / 2;
		const startClickX = startX + clickOffset;
		const startClickY = startY + clickOffset;
		const endClickX = endX + clickOffset;
		const endClickY = endY + clickOffset;

		console.log(`🎯 Executing: ${sanMove} (UCI: ${uciMove})`);
		console.log(
			`📍 Clicking from (${startClickX}, ${startClickY}) to (${endClickX}, ${endClickY})`,
		);

		await boardLocator.click({
			position: { x: startClickX, y: startClickY },
			timeout: 3000,
		});
		await new Promise((resolve) => setTimeout(resolve, 500));

		await boardLocator.click({
			position: { x: endClickX, y: endClickY },
			timeout: 3000,
		});
		await new Promise((resolve) => setTimeout(resolve, 500));

		return new ActionResult({
			extractedContent: `✅ Successfully executed chess move: ${sanMove}`,
			includeInMemory: true,
		});
	} catch (e) {
		const errorMessage = `❌ Failed to execute chess move ${sanMove}: ${e}`;
		console.error(`ERROR: ${errorMessage}`);
		return new ActionResult({
			extractedContent: errorMessage,
		});
	}
});

// Configure browser session
const browserSession = new BrowserSession({
	browserProfile: new BrowserProfile({
		disableSecurity: true,
		userDataDir: "~/.config/browsernode/profiles/chess",
	}),
});

async function main() {
	const llm = new ChatOpenAI({
		model: "gpt-4o",
		apiKey: process.env.OPENAI_API_KEY!,
	});

	const agent = new Agent(
		`
        Objective: Play chess against the computer on Lichess and win.

        Strategy: Play the Queen's Gambit opening (1. d4 d5 2. c4) as White. Aim for a solid, strategic game.

        *** CRITICAL: You MUST use these exact custom actions for chess operations: ***
        1. "analyzeChessBoard" - ONLY action to read chess board state and get legal moves
        2. "executeChessMove" - ONLY action to play chess moves on the board
        
        *** DO NOT use any other actions like readCellContents, click, or input for chess operations ***

        Instructions:
        1. Open lichess.org.
        2. Find and click the button or link with the text "Play with the computer". Use a standard click action.
        3. On the setup screen, ensure 'White' is selected. Click the "Play" or "Start game" button.
        
        4. **MANDATORY**: Use "analyzeChessBoard" action (not readCellContents or any other action). 
           This will return: "CHESS BOARD ANALYSIS: FEN: [position] Legal Moves (SAN): [list]"
        
        5. The 'Legal Moves (SAN)' list will contain moves like 'Nf3' (Knight to f3), 'e4' (pawn to e4), 'O-O' (kingside castle), 'Rxe4+' (Rook captures on e4, giving check), or 'Qh7#' (Queen to h7, checkmate).
        
        6. **MANDATORY**: Choose your next move EXACTLY as it appears in the 'Legal Moves (SAN)' list. Do not invent moves.
        
        7. **MANDATORY**: Use "executeChessMove" action (not click or any other action) with the exact SAN string.
           Example: executeChessMove({move: 'd4'}) or executeChessMove({move: 'Nf3'})
        
        8. Repeat steps 4-7 until the game ends. If anything seems wrong, use "analyzeChessBoard" again.
        
        9. Announce the final result.

        *** REMINDER: Use ONLY "analyzeChessBoard" and "executeChessMove" for all chess operations ***
        `,
		llm,
		{
			useVision: true,
			controller: controller,
			browserSession: browserSession,
		},
	);

	try {
		const result = await agent.run();
		console.log("🎯 Chess game completed:", result);
	} catch (error) {
		console.error("❌ Error running chess agent:", error);
	} finally {
		await browserSession.close();
	}
}

// Run the main function
main().catch(console.error);
