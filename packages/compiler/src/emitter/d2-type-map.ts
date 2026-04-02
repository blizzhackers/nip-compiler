/**
 * D2 1.13 item type data, auto-generated from game files.
 * Sources: Armor.txt, Weapons.txt, Misc.txt, ItemTypes.txt
 * Repo: https://github.com/fabd/diablo2/tree/master/code/d2_113_data
 *
 * Used by the emitter for:
 * - Type-to-classid expansion: [type] == armor → all 45 armor classids
 * - Impossible quality filtering: charms can't be rare, runes can't be magic
 * - Always-identified detection: runes/gems/potions skip _id checks
 *
 * typeProperties.normal means "simple item" — always identified, no magical
 * affixes. Runes have inherent effects (e.g. Cannot Be Frozen) but these
 * are fixed per rune, not hidden behind identification.
 */

/** Maps item type ID to all classids of that type. */
export const typeToClassIds: Record<number, number[]> = {
  2: [328,329,330,331,332,333,350,351,374,375,376,377,378,379,396,397,444,445,446,447,448,449,466,467], // shield
  3: [313,314,315,316,317,318,319,320,321,322,323,324,325,326,327,359,360,361,362,363,364,365,366,367,368,369,370,371,372,373,429,430,431,432,433,434,435,436,437,438,439,440,441,442,443], // armor
  4: [523], // gold
  5: [526], // bowquiver
  6: [528], // crossbowquiver
  7: [556], // playerbodypart
  8: [602], // herb
  10: [522], // ring
  11: [508], // elixir
  12: [520,521], // amulet
  15: [339,340,341,342,343,385,386,387,388,389,455,456,457,458,459], // boots
  16: [334,335,336,337,338,380,381,382,383,384,450,451,452,453,454], // gloves
  18: [518,519], // book
  19: [344,345,346,347,348,390,391,392,393,394,460,461,462,463,464], // belt
  21: [527], // torch
  22: [529,530,645], // scroll
  24: [15,16,17,108,109,110,211,212,213], // scepter
  25: [10,11,12,13,103,104,105,106,206,207,208,209], // wand
  26: [63,64,65,66,67,91,92,156,157,158,159,160,259,260,261,262,263], // staff
  27: [68,69,70,71,72,73,74,75,161,162,163,164,165,166,167,168,264,265,266,267,268,269,270,271], // bow
  28: [0,1,2,3,4,5,6,7,8,9,93,94,95,96,97,98,99,100,101,102,196,197,198,199,200,201,202,203,204,205], // axe
  29: [14,18,88,107,111,210,214], // club
  30: [25,26,27,28,29,30,31,32,33,34,35,36,37,38,118,119,120,121,122,123,124,125,126,127,128,129,130,131,221,222,223,224,225,226,227,228,229,230,231,232,233,234], // sword
  31: [22,23,24,89,90,115,116,117,218,219,220], // hammer
  32: [39,40,41,42,86,87,132,133,134,135,235,236,237,238], // knife
  33: [52,53,54,55,56,145,146,147,148,149,248,249,250,251,252], // spear
  34: [57,58,59,60,61,62,150,151,152,153,154,155,253,254,255,256,257,258], // polearm
  35: [76,77,78,79,169,170,171,172,272,273,274,275], // crossbow
  36: [19,20,21,112,113,114,173,174,215,216,217], // mace
  37: [306,307,308,309,310,311,312,349,352,353,354,355,356,357,358,395,422,423,424,425,426,427,428,465], // helm
  38: [80,81,82,83,84,85], // missilepotion
  39: [524,525,545,546,547,548,549,550,551,552,553,554,555,644,646,647,648,649,650,651,652,653,654,655,656,657,658], // quest
  40: [531,532,533,534,535,536,537,538,539,540,541,542], // bodypart
  41: [543,544], // key
  42: [43,45,136,138,239,241], // throwingknife
  43: [44,46,137,139,240,242], // throwingaxe
  44: [47,48,49,50,51,140,141,142,143,144,243,244,245,246,247], // javelin
  58: [643], // jewel
  67: [175,176,177,178,179,180,181,182,183,184,185,186,187,188,189,190,191,192,193,194,195], // handtohand
  68: [276,277,278,279,280,286,287,288,289,290,296,297,298,299,300], // orb
  69: [413,414,415,416,417,483,484,485,486,487,503,504,505,506,507], // voodooheads
  70: [408,409,410,411,412,478,479,480,481,482,498,499,500,501,502], // auricshields
  71: [403,404,405,406,407,473,474,475,476,477,493,494,495,496,497], // primalhelm
  72: [398,399,400,401,402,468,469,470,471,472,488,489,490,491,492], // pelt
  74: [610,611,612,613,614,615,616,617,618,619,620,621,622,623,624,625,626,627,628,629,630,631,632,633,634,635,636,637,638,639,640,641,642], // rune
  75: [418,419,420,421], // circlet
  76: [509,511,587,588,589,590,591,606,607], // healingpotion
  77: [510,512,592,593,594,595,596,608,609], // manapotion
  78: [515,516], // rejuvpotion
  79: [513], // staminapotion
  80: [514], // antidotepotion
  81: [517], // thawingpotion
  82: [603], // smallcharm
  83: [604], // mediumcharm
  84: [605], // largecharm
  85: [281,282,291,292,301,302], // amazonbow
  86: [283,284,293,294,303,304], // amazonspear
  87: [285,295,305], // amazonjavelin
  96: [557,558,559,560,561], // amethyst
  97: [582,583,584,585,586], // diamond
  98: [572,573,574,575,576], // emerald
  99: [577,578,579,580,581], // ruby
  100: [567,568,569,570,571], // sapphire
  101: [562,563,564,565,566], // topaz
  102: [597,598,599,600,601], // skull
};

/** Maps classid to its item type ID. */
export const classIdToType: Record<number, number> = {
  0: 28,
  1: 28,
  2: 28,
  3: 28,
  4: 28,
  5: 28,
  6: 28,
  7: 28,
  8: 28,
  9: 28,
  10: 25,
  11: 25,
  12: 25,
  13: 25,
  14: 29,
  15: 24,
  16: 24,
  17: 24,
  18: 29,
  19: 36,
  20: 36,
  21: 36,
  22: 31,
  23: 31,
  24: 31,
  25: 30,
  26: 30,
  27: 30,
  28: 30,
  29: 30,
  30: 30,
  31: 30,
  32: 30,
  33: 30,
  34: 30,
  35: 30,
  36: 30,
  37: 30,
  38: 30,
  39: 32,
  40: 32,
  41: 32,
  42: 32,
  43: 42,
  44: 43,
  45: 42,
  46: 43,
  47: 44,
  48: 44,
  49: 44,
  50: 44,
  51: 44,
  52: 33,
  53: 33,
  54: 33,
  55: 33,
  56: 33,
  57: 34,
  58: 34,
  59: 34,
  60: 34,
  61: 34,
  62: 34,
  63: 26,
  64: 26,
  65: 26,
  66: 26,
  67: 26,
  68: 27,
  69: 27,
  70: 27,
  71: 27,
  72: 27,
  73: 27,
  74: 27,
  75: 27,
  76: 35,
  77: 35,
  78: 35,
  79: 35,
  80: 38,
  81: 38,
  82: 38,
  83: 38,
  84: 38,
  85: 38,
  86: 32,
  87: 32,
  88: 29,
  89: 31,
  90: 31,
  91: 26,
  92: 26,
  93: 28,
  94: 28,
  95: 28,
  96: 28,
  97: 28,
  98: 28,
  99: 28,
  100: 28,
  101: 28,
  102: 28,
  103: 25,
  104: 25,
  105: 25,
  106: 25,
  107: 29,
  108: 24,
  109: 24,
  110: 24,
  111: 29,
  112: 36,
  113: 36,
  114: 36,
  115: 31,
  116: 31,
  117: 31,
  118: 30,
  119: 30,
  120: 30,
  121: 30,
  122: 30,
  123: 30,
  124: 30,
  125: 30,
  126: 30,
  127: 30,
  128: 30,
  129: 30,
  130: 30,
  131: 30,
  132: 32,
  133: 32,
  134: 32,
  135: 32,
  136: 42,
  137: 43,
  138: 42,
  139: 43,
  140: 44,
  141: 44,
  142: 44,
  143: 44,
  144: 44,
  145: 33,
  146: 33,
  147: 33,
  148: 33,
  149: 33,
  150: 34,
  151: 34,
  152: 34,
  153: 34,
  154: 34,
  155: 34,
  156: 26,
  157: 26,
  158: 26,
  159: 26,
  160: 26,
  161: 27,
  162: 27,
  163: 27,
  164: 27,
  165: 27,
  166: 27,
  167: 27,
  168: 27,
  169: 35,
  170: 35,
  171: 35,
  172: 35,
  173: 36,
  174: 36,
  175: 67,
  176: 67,
  177: 67,
  178: 67,
  179: 67,
  180: 67,
  181: 67,
  182: 67,
  183: 67,
  184: 67,
  185: 67,
  186: 67,
  187: 67,
  188: 67,
  189: 67,
  190: 67,
  191: 67,
  192: 67,
  193: 67,
  194: 67,
  195: 67,
  196: 28,
  197: 28,
  198: 28,
  199: 28,
  200: 28,
  201: 28,
  202: 28,
  203: 28,
  204: 28,
  205: 28,
  206: 25,
  207: 25,
  208: 25,
  209: 25,
  210: 29,
  211: 24,
  212: 24,
  213: 24,
  214: 29,
  215: 36,
  216: 36,
  217: 36,
  218: 31,
  219: 31,
  220: 31,
  221: 30,
  222: 30,
  223: 30,
  224: 30,
  225: 30,
  226: 30,
  227: 30,
  228: 30,
  229: 30,
  230: 30,
  231: 30,
  232: 30,
  233: 30,
  234: 30,
  235: 32,
  236: 32,
  237: 32,
  238: 32,
  239: 42,
  240: 43,
  241: 42,
  242: 43,
  243: 44,
  244: 44,
  245: 44,
  246: 44,
  247: 44,
  248: 33,
  249: 33,
  250: 33,
  251: 33,
  252: 33,
  253: 34,
  254: 34,
  255: 34,
  256: 34,
  257: 34,
  258: 34,
  259: 26,
  260: 26,
  261: 26,
  262: 26,
  263: 26,
  264: 27,
  265: 27,
  266: 27,
  267: 27,
  268: 27,
  269: 27,
  270: 27,
  271: 27,
  272: 35,
  273: 35,
  274: 35,
  275: 35,
  276: 68,
  277: 68,
  278: 68,
  279: 68,
  280: 68,
  281: 85,
  282: 85,
  283: 86,
  284: 86,
  285: 87,
  286: 68,
  287: 68,
  288: 68,
  289: 68,
  290: 68,
  291: 85,
  292: 85,
  293: 86,
  294: 86,
  295: 87,
  296: 68,
  297: 68,
  298: 68,
  299: 68,
  300: 68,
  301: 85,
  302: 85,
  303: 86,
  304: 86,
  305: 87,
  306: 37,
  307: 37,
  308: 37,
  309: 37,
  310: 37,
  311: 37,
  312: 37,
  313: 3,
  314: 3,
  315: 3,
  316: 3,
  317: 3,
  318: 3,
  319: 3,
  320: 3,
  321: 3,
  322: 3,
  323: 3,
  324: 3,
  325: 3,
  326: 3,
  327: 3,
  328: 2,
  329: 2,
  330: 2,
  331: 2,
  332: 2,
  333: 2,
  334: 16,
  335: 16,
  336: 16,
  337: 16,
  338: 16,
  339: 15,
  340: 15,
  341: 15,
  342: 15,
  343: 15,
  344: 19,
  345: 19,
  346: 19,
  347: 19,
  348: 19,
  349: 37,
  350: 2,
  351: 2,
  352: 37,
  353: 37,
  354: 37,
  355: 37,
  356: 37,
  357: 37,
  358: 37,
  359: 3,
  360: 3,
  361: 3,
  362: 3,
  363: 3,
  364: 3,
  365: 3,
  366: 3,
  367: 3,
  368: 3,
  369: 3,
  370: 3,
  371: 3,
  372: 3,
  373: 3,
  374: 2,
  375: 2,
  376: 2,
  377: 2,
  378: 2,
  379: 2,
  380: 16,
  381: 16,
  382: 16,
  383: 16,
  384: 16,
  385: 15,
  386: 15,
  387: 15,
  388: 15,
  389: 15,
  390: 19,
  391: 19,
  392: 19,
  393: 19,
  394: 19,
  395: 37,
  396: 2,
  397: 2,
  398: 72,
  399: 72,
  400: 72,
  401: 72,
  402: 72,
  403: 71,
  404: 71,
  405: 71,
  406: 71,
  407: 71,
  408: 70,
  409: 70,
  410: 70,
  411: 70,
  412: 70,
  413: 69,
  414: 69,
  415: 69,
  416: 69,
  417: 69,
  418: 75,
  419: 75,
  420: 75,
  421: 75,
  422: 37,
  423: 37,
  424: 37,
  425: 37,
  426: 37,
  427: 37,
  428: 37,
  429: 3,
  430: 3,
  431: 3,
  432: 3,
  433: 3,
  434: 3,
  435: 3,
  436: 3,
  437: 3,
  438: 3,
  439: 3,
  440: 3,
  441: 3,
  442: 3,
  443: 3,
  444: 2,
  445: 2,
  446: 2,
  447: 2,
  448: 2,
  449: 2,
  450: 16,
  451: 16,
  452: 16,
  453: 16,
  454: 16,
  455: 15,
  456: 15,
  457: 15,
  458: 15,
  459: 15,
  460: 19,
  461: 19,
  462: 19,
  463: 19,
  464: 19,
  465: 37,
  466: 2,
  467: 2,
  468: 72,
  469: 72,
  470: 72,
  471: 72,
  472: 72,
  473: 71,
  474: 71,
  475: 71,
  476: 71,
  477: 71,
  478: 70,
  479: 70,
  480: 70,
  481: 70,
  482: 70,
  483: 69,
  484: 69,
  485: 69,
  486: 69,
  487: 69,
  488: 72,
  489: 72,
  490: 72,
  491: 72,
  492: 72,
  493: 71,
  494: 71,
  495: 71,
  496: 71,
  497: 71,
  498: 70,
  499: 70,
  500: 70,
  501: 70,
  502: 70,
  503: 69,
  504: 69,
  505: 69,
  506: 69,
  507: 69,
  508: 11,
  509: 76,
  510: 77,
  511: 76,
  512: 77,
  513: 79,
  514: 80,
  515: 78,
  516: 78,
  517: 81,
  518: 18,
  519: 18,
  520: 12,
  521: 12,
  522: 10,
  523: 4,
  524: 39,
  525: 39,
  526: 5,
  527: 21,
  528: 6,
  529: 22,
  530: 22,
  531: 40,
  532: 40,
  533: 40,
  534: 40,
  535: 40,
  536: 40,
  537: 40,
  538: 40,
  539: 40,
  540: 40,
  541: 40,
  542: 40,
  543: 41,
  544: 41,
  545: 39,
  546: 39,
  547: 39,
  548: 39,
  549: 39,
  550: 39,
  551: 39,
  552: 39,
  553: 39,
  554: 39,
  555: 39,
  556: 7,
  557: 96,
  558: 96,
  559: 96,
  560: 96,
  561: 96,
  562: 101,
  563: 101,
  564: 101,
  565: 101,
  566: 101,
  567: 100,
  568: 100,
  569: 100,
  570: 100,
  571: 100,
  572: 98,
  573: 98,
  574: 98,
  575: 98,
  576: 98,
  577: 99,
  578: 99,
  579: 99,
  580: 99,
  581: 99,
  582: 97,
  583: 97,
  584: 97,
  585: 97,
  586: 97,
  587: 76,
  588: 76,
  589: 76,
  590: 76,
  591: 76,
  592: 77,
  593: 77,
  594: 77,
  595: 77,
  596: 77,
  597: 102,
  598: 102,
  599: 102,
  600: 102,
  601: 102,
  602: 8,
  603: 82,
  604: 83,
  605: 84,
  606: 76,
  607: 76,
  608: 77,
  609: 77,
  610: 74,
  611: 74,
  612: 74,
  613: 74,
  614: 74,
  615: 74,
  616: 74,
  617: 74,
  618: 74,
  619: 74,
  620: 74,
  621: 74,
  622: 74,
  623: 74,
  624: 74,
  625: 74,
  626: 74,
  627: 74,
  628: 74,
  629: 74,
  630: 74,
  631: 74,
  632: 74,
  633: 74,
  634: 74,
  635: 74,
  636: 74,
  637: 74,
  638: 74,
  639: 74,
  640: 74,
  641: 74,
  642: 74,
  643: 58,
  644: 39,
  645: 22,
  646: 39,
  647: 39,
  648: 39,
  649: 39,
  650: 39,
  651: 39,
  652: 39,
  653: 39,
  654: 39,
  655: 39,
  656: 39,
  657: 39,
  658: 39,
};

/**
 * Item type properties from ItemTypes.txt.
 * magic: can this type roll magic quality?
 * rare: can this type roll rare quality?
 * charm: is this a charm type? (magic only, not rare)
 * normal: can this type be normal (white) quality?
 * maxSock1/25/40: maximum sockets at ilvl 1-25, 25-40, 40+
 */
export interface ItemTypeProps {
  magic: boolean;
  rare: boolean;
  charm: boolean;
  normal: boolean;
  maxSock1: number;
  maxSock25: number;
  maxSock40: number;
}

export const typeProperties: Record<number, ItemTypeProps> = {
  2: { magic: false, rare: true, charm: false, normal: false, maxSock1: 3, maxSock25: 3, maxSock40: 4 }, // shield
  3: { magic: false, rare: true, charm: false, normal: false, maxSock1: 3, maxSock25: 4, maxSock40: 6 }, // armor
  4: { magic: false, rare: false, charm: false, normal: true, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // gold
  5: { magic: false, rare: false, charm: false, normal: true, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // bowquiver
  6: { magic: false, rare: false, charm: false, normal: true, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // crossbowquiver
  7: { magic: false, rare: false, charm: true, normal: true, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // playerbodypart
  8: { magic: false, rare: false, charm: false, normal: false, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // herb
  9: { magic: false, rare: false, charm: false, normal: true, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // potion
  10: { magic: true, rare: true, charm: false, normal: false, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // ring
  11: { magic: false, rare: false, charm: false, normal: false, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // elixir
  12: { magic: true, rare: true, charm: false, normal: false, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // amulet
  13: { magic: true, rare: false, charm: true, normal: false, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // charm
  15: { magic: false, rare: true, charm: false, normal: false, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // boots
  16: { magic: false, rare: true, charm: false, normal: false, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // gloves
  18: { magic: false, rare: false, charm: false, normal: true, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // book
  19: { magic: false, rare: true, charm: false, normal: false, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // belt
  20: { magic: false, rare: false, charm: false, normal: true, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // gem
  21: { magic: false, rare: false, charm: false, normal: true, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // torch
  22: { magic: false, rare: false, charm: false, normal: true, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // scroll
  24: { magic: false, rare: true, charm: false, normal: false, maxSock1: 3, maxSock25: 5, maxSock40: 6 }, // scepter
  25: { magic: false, rare: true, charm: false, normal: false, maxSock1: 2, maxSock25: 2, maxSock40: 2 }, // wand
  26: { magic: false, rare: true, charm: false, normal: false, maxSock1: 5, maxSock25: 6, maxSock40: 6 }, // staff
  27: { magic: false, rare: true, charm: false, normal: false, maxSock1: 3, maxSock25: 4, maxSock40: 6 }, // bow
  28: { magic: false, rare: true, charm: false, normal: false, maxSock1: 4, maxSock25: 5, maxSock40: 6 }, // axe
  29: { magic: false, rare: true, charm: false, normal: false, maxSock1: 3, maxSock25: 4, maxSock40: 6 }, // club
  30: { magic: false, rare: true, charm: false, normal: false, maxSock1: 3, maxSock25: 4, maxSock40: 6 }, // sword
  31: { magic: false, rare: true, charm: false, normal: false, maxSock1: 3, maxSock25: 4, maxSock40: 6 }, // hammer
  32: { magic: false, rare: true, charm: false, normal: false, maxSock1: 2, maxSock25: 3, maxSock40: 3 }, // knife
  33: { magic: false, rare: true, charm: false, normal: false, maxSock1: 3, maxSock25: 4, maxSock40: 6 }, // spear
  34: { magic: false, rare: true, charm: false, normal: false, maxSock1: 3, maxSock25: 4, maxSock40: 6 }, // polearm
  35: { magic: false, rare: true, charm: false, normal: false, maxSock1: 3, maxSock25: 4, maxSock40: 6 }, // crossbow
  36: { magic: false, rare: true, charm: false, normal: false, maxSock1: 3, maxSock25: 4, maxSock40: 6 }, // mace
  37: { magic: false, rare: true, charm: false, normal: false, maxSock1: 2, maxSock25: 2, maxSock40: 3 }, // helm
  38: { magic: false, rare: false, charm: false, normal: true, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // missilepotion
  39: { magic: false, rare: false, charm: false, normal: false, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // quest
  40: { magic: false, rare: false, charm: false, normal: true, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // bodypart
  41: { magic: false, rare: false, charm: false, normal: true, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // key
  42: { magic: false, rare: true, charm: false, normal: false, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // throwingknife
  43: { magic: false, rare: true, charm: false, normal: false, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // throwingaxe
  44: { magic: false, rare: true, charm: false, normal: false, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // javelin
  45: { magic: false, rare: true, charm: false, normal: false, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // weapon
  46: { magic: false, rare: true, charm: false, normal: false, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // meleeweapon
  47: { magic: false, rare: true, charm: false, normal: false, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // missileweapon
  48: { magic: false, rare: true, charm: false, normal: false, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // thrownweapon
  49: { magic: false, rare: true, charm: false, normal: false, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // comboweapon
  50: { magic: false, rare: true, charm: false, normal: false, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // anyarmor
  51: { magic: false, rare: true, charm: false, normal: false, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // anyshield
  52: { magic: false, rare: true, charm: false, normal: false, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // miscellaneous
  53: { magic: false, rare: false, charm: false, normal: false, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // socketfiller
  54: { magic: false, rare: true, charm: false, normal: false, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // secondhand
  55: { magic: false, rare: true, charm: false, normal: false, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // stavesandrods
  56: { magic: false, rare: false, charm: false, normal: false, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // missile
  57: { magic: false, rare: true, charm: false, normal: false, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // blunt
  58: { magic: true, rare: true, charm: false, normal: false, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // jewel
  59: { magic: false, rare: true, charm: false, normal: false, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // classspecific
  60: { magic: false, rare: true, charm: false, normal: false, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // amazonitem
  61: { magic: false, rare: true, charm: false, normal: false, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // barbarianitem
  62: { magic: false, rare: true, charm: false, normal: false, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // necromanceritem
  63: { magic: false, rare: true, charm: false, normal: false, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // paladinitem
  64: { magic: false, rare: true, charm: false, normal: false, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // sorceressitem
  65: { magic: false, rare: true, charm: false, normal: false, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // assassinitem
  66: { magic: false, rare: true, charm: false, normal: false, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // druiditem
  67: { magic: false, rare: true, charm: false, normal: false, maxSock1: 2, maxSock25: 3, maxSock40: 3 }, // handtohand
  68: { magic: false, rare: true, charm: false, normal: false, maxSock1: 2, maxSock25: 3, maxSock40: 3 }, // orb
  69: { magic: false, rare: true, charm: false, normal: false, maxSock1: 2, maxSock25: 3, maxSock40: 3 }, // voodooheads
  70: { magic: false, rare: true, charm: false, normal: false, maxSock1: 3, maxSock25: 4, maxSock40: 4 }, // auricshields
  71: { magic: false, rare: true, charm: false, normal: false, maxSock1: 2, maxSock25: 3, maxSock40: 3 }, // primalhelm
  72: { magic: false, rare: true, charm: false, normal: false, maxSock1: 2, maxSock25: 3, maxSock40: 3 }, // pelt
  73: { magic: false, rare: true, charm: false, normal: false, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // cloak
  74: { magic: false, rare: false, charm: false, normal: true, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // rune
  75: { magic: false, rare: true, charm: false, normal: false, maxSock1: 1, maxSock25: 2, maxSock40: 3 }, // circlet
  76: { magic: false, rare: false, charm: false, normal: true, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // healingpotion
  77: { magic: false, rare: false, charm: false, normal: true, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // manapotion
  78: { magic: false, rare: false, charm: false, normal: true, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // rejuvpotion
  79: { magic: false, rare: false, charm: false, normal: true, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // staminapotion
  80: { magic: false, rare: false, charm: false, normal: true, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // antidotepotion
  81: { magic: false, rare: false, charm: false, normal: true, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // thawingpotion
  82: { magic: true, rare: false, charm: true, normal: false, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // smallcharm
  83: { magic: true, rare: false, charm: true, normal: false, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // mediumcharm
  84: { magic: true, rare: false, charm: true, normal: false, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // largecharm
  85: { magic: false, rare: true, charm: false, normal: false, maxSock1: 3, maxSock25: 4, maxSock40: 5 }, // amazonbow
  86: { magic: false, rare: true, charm: false, normal: false, maxSock1: 3, maxSock25: 4, maxSock40: 6 }, // amazonspear
  87: { magic: false, rare: true, charm: false, normal: false, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // amazonjavelin
  89: { magic: true, rare: true, charm: false, normal: false, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // magicbowquiv
  90: { magic: true, rare: true, charm: false, normal: false, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // magicxbowquiv
  91: { magic: false, rare: false, charm: false, normal: true, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // chippedgem
  92: { magic: false, rare: false, charm: false, normal: true, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // flawedgem
  93: { magic: false, rare: false, charm: false, normal: true, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // standardgem
  94: { magic: false, rare: false, charm: false, normal: true, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // flawlessgem
  95: { magic: false, rare: false, charm: false, normal: true, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // perfectgem
  96: { magic: false, rare: false, charm: false, normal: true, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // amethyst
  97: { magic: false, rare: false, charm: false, normal: true, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // diamond
  98: { magic: false, rare: false, charm: false, normal: true, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // emerald
  99: { magic: false, rare: false, charm: false, normal: true, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // ruby
  100: { magic: false, rare: false, charm: false, normal: true, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // sapphire
  101: { magic: false, rare: false, charm: false, normal: true, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // topaz
  102: { magic: false, rare: false, charm: false, normal: true, maxSock1: 0, maxSock25: 0, maxSock40: 0 }, // skull
};
