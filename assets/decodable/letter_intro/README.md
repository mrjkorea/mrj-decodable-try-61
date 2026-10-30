# Letter-intro videos (books 61–80)

Each book plays its letter-intro video in the intro, after the sound card and before the famous word:

`cousin` (sound card) → **`letter-intro`** → `famous-card` → `famous` → `chase` (books 61–70) → Listen

Books 71–80 have no sound card, so they open straight into the letter-intro video.

The app loads `assets/decodable/letter_intro/<file>?v=<ASSET_V>` through `asset()`. The file names come from
`letter_intros` in `assets/align_mlr_dec_0NN.json`; `LETTER_INTRO` in `index.html` is the fallback when an
align file has no `letter_intros`.

## Files

The mp4s are not committed yet; they arrive in a follow-up `tar.gz`. Put the 20 files directly in this folder
(no subfolders), with exactly these names:

| Book | Sound | File |
| --- | --- | --- |
| mlr_dec_061 | ai / ay | `ai_ay_letter_intro.mp4` |
| mlr_dec_062 | ee | `ee_letter_intro.mp4` |
| mlr_dec_063 | ea (eat) | `ea_ee_letter_intro.mp4` |
| mlr_dec_064 | igh | `igh_letter_intro.mp4` |
| mlr_dec_065 | oa | `oa_letter_intro.mp4` |
| mlr_dec_066 | oo (moon) | `oo_long_letter_intro.mp4` |
| mlr_dec_067 | oo (book) | `oo_short_letter_intro.mp4` |
| mlr_dec_068 | ou / ow (cow) | `ou_ow_letter_intro.mp4` |
| mlr_dec_069 | oi / oy | `oi_oy_letter_intro.mp4` |
| mlr_dec_070 | au / aw | `au_aw_letter_intro.mp4` |
| mlr_dec_071 | schwa a | `schwa_a_letter_intro.mp4` |
| mlr_dec_072 | ey | `ey_letter_intro.mp4` |
| mlr_dec_073 | ea (bread) | `ea_short_letter_intro.mp4` |
| mlr_dec_074 | ow (snow) | `ow_long_letter_intro.mp4` |
| mlr_dec_075 | ew / ue | `ew_ue_letter_intro.mp4` |
| mlr_dec_076 | air | `air_letter_intro.mp4` |
| mlr_dec_077 | ear | `ear_letter_intro.mp4` |
| mlr_dec_078 | kn | `kn_letter_intro.mp4` |
| mlr_dec_079 | wr | `wr_letter_intro.mp4` |
| mlr_dec_080 | mb | `mb_letter_intro.mp4` |

## Adding the videos

```bash
tar -xzf letter_intro_61_80.tar.gz -C assets/decodable/letter_intro/   # add --strip-components=1 if the archive has a top folder
LETTER_INTRO_REQUIRE_MP4=1 node test/letter-intro.test.js              # all 20 present, real MP4s, H.264
```

Encode as H.264 video + AAC audio in MP4 so iPad/iPhone Safari and Chrome both play it. `-movflags +faststart`
lets playback start before the whole file has downloaded.

## What students see

- The video fills the intro stage. Next stays disabled until the video ends; then the step reports
  `letter-intro` once per book (`mlr_dec_0NN:letter-intro`).
- If the browser blocks autoplay with sound, a ▶ button appears; tapping it starts the video.
- Tapping the video after it ends plays it again.
- If a file is missing or will not decode, the step shows "The letter video is not ready yet. Tap Next.",
  unlocks Next, and reports nothing, so books 61–80 keep working before the mp4s land.
