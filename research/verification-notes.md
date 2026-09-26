# Verification notes for the reference list

The first draft of the reference list came from a Gemini Deep Research report (26 September 2026). The report is not in this repository, because its citations are not reliable. Its BibTeX block tagged every entry but one as verified, but 7 of its 12 DOIs pointed to a different paper or did not exist, and one more entry had the correct DOI with the wrong authors and title. Use `references.bib` in this folder.

Each entry below was checked on 26 September 2026 against Crossref metadata for the DOI, a Crossref title search, OpenAlex, or the reference lists that peer-reviewed TURF papers deposit with Crossref.

| Gemini key | Status | Correct record and source |
|---|---|---|
| church1974maximal | Confirmed | Crossref, DOI 10.1007/BF01942293. |
| serra2013implementing | Corrected | The DOI is 10.1016/j.foodqual.2012.10.001. The Gemini DOI (.007) is a paper by Poinot et al. on aroma interactions. Other details confirmed by Crossref. Abstract checked on RePEc (UPF working paper 1197). |
| ennis2012eturf | Confirmed | Crossref, DOI 10.1016/j.foodqual.2011.06.004. |
| ennis2011validating | Corrected | The authors are Nestrud, M. A., Ennis, J. M., Fayle, C. M., Ennis, D. M., and Lawless, H. T. The record is Journal of Sensory Studies 26(5), 331-338, DOI 10.1111/j.1745-459X.2011.00348.x. The Gemini DOI is a paper by Sepulveda et al. on chewing gum. |
| ennis2012assignment | Corrected | The DOI is 10.1145/2133803.2275596, volume 17, July 2012, Article 1.5 (pages 1.1-1.17), from the ACM Digital Library page and DBLP. Crossref and OpenAlex give no article number. The Gemini DOI does not exist. |
| miaoulis1990turf | Confirmed | No DOI. Marketing Research 2(1), 28-40, March 1990. The EBSCO index of Marketing Research (accession number 7665661) confirms volume 2, issue 1, 1990, and start page 28. The end page 40 is from the reference list of Kuesten and Bi (2021). The EBSCO index gives the author order Miaoulis, Parsons, Free, but every citing paper checked (Serra 2013; Ennis et al. 2012; Kuesten and Bi 2021; Camm et al. 2022; Schramm et al. 2026) gives Miaoulis, Free, Parsons. The package uses the second order until someone checks the byline of the article. |
| krieger2000turf | Corrected | No DOI. Marketing Research 12, 30-36, from Abba Krieger's CV (Wharton, December 2020) and the reference lists of Ennis et al. (2012) and Kuesten and Bi (2021). No source confirms the issue number 2 that Gemini gives, so it is left out. |
| green1985models | Confirmed | Crossref, DOI 10.1287/mksc.4.1.1. |
| agostini1961analysis | Dropped | Not found in Crossref or OpenAlex. |
| conklin2004turf | Dropped | The Quirk's article was not found. The confirmed paper is Conklin, W. M., and Lipovetsky, S. (2005), International Journal of Information Technology and Decision Making 4(1), 5-19, DOI 10.1142/S0219622005001374 (Gemini works cited, item 4). |
| lipovetsky2008surf | Corrected | Pages 203-216, DOI 10.1142/S0219622008002909. The Gemini DOI is a paper by Cao et al. on activity mining. The published title has a dash after "SURF". `references.bib` and the README use a colon there. |
| lipovetsky2014finding | Corrected, not cited | Journal of Choice Modelling 12, 1-9, DOI 10.1016/j.jocm.2014.08.001 (OpenAlex). The Gemini DOI does not exist. |
| farasyn2022integer | Corrected | The DOI is correct, but the authors are Camm, J. D., Christman, J., and Narayanan, A. The title is "Total unduplicated reach and frequency optimization at Procter & Gamble", and the pages are 149-157 (Crossref). |
| adler2010optimizing | Corrected | Pages 483-497, DOI 10.1108/9781849507738-022. The Gemini DOI is a chapter by Lanz et al. The editors (Hess and Daly) are confirmed by Crossref. |
| schramm2025biturf | Corrected | The record is Schramm, J. B., Lang, F. J., and Lichters, M. (2026), "BiTURF: Quantifying uncertainty to enhance strategic decision-making", Food Quality and Preference 145, 106001, DOI 10.1016/j.foodqual.2026.106001. The Gemini DOI is a paper by Abeywickrema et al. on plant-based diets. |
| daskin2013network | Confirmed, not cited | The book exists (DOI 10.1002/9781118537015). The claim Gemini cites it for was not checked. |
| ennis1995turf | Dropped | Not found. The eTURF reference list has Ennis, D., and Mullen, K. (1995), "Maximizing potential market share based on product and/or concept choices", an Institute for Perception report. |

## Other corrections

- turfR: the author is Jack Horne, not Daniel Ball. The license is GPL (>= 2), not GPL-3. CRAN removed the package on 2022-02-04, so it is not on CRAN now. Source: the CRAN package page and the DESCRIPTION file of turfR 0.8-7 in the CRAN archive.
- No package with "turf" in its name is on CRAN now (query of `available.packages()` on 26 September 2026).
- Ennis, J. M., and Fayle, C. M. (2010), "Portfolio optimization based on first choice", IFPress 13(2), 2-3, comes from the reference list of Ennis et al. (2012) only. Gemini did not find it.
